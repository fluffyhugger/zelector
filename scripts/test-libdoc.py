"""
Every keyword the generator emits, against the library's own documentation.

The exports are written from the SeleniumLibrary docs, which is a different
thing from being checked against them. The parser pass says a file is valid
Robot Framework; it has nothing to say about whether `Select Radio Button`
takes a locator, or whether `Clear Element Text` exists at all. A keyword that
does not exist fails at run time, on someone else's machine, with a message
about a keyword name rather than about the recording that produced it.

So: generate the suites, read the calls out of them with Robot's own parser,
and ask libdoc about each one — does it exist, and does it take the arguments
being handed to it.

    npm run test:libdoc
"""
from __future__ import annotations

import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYTHON = ROOT / ".venv" / "bin" / "python"

try:
    from robot.api import get_model
    from robot.parsing.model.visitor import ModelVisitor
    from robot.libdocpkg import LibraryDocumentation
except ImportError:
    print("No robotframework in .venv. Run:\n"
          "  python3 -m venv .venv && .venv/bin/pip install robotframework "
          "robotframework-seleniumlibrary")
    sys.exit(1)

LIBRARIES = ["SeleniumLibrary", "BuiltIn"]

# Keywords the fixtures exercise a path for, so the generator must reach them.
#
# renderDialog existed, the panel displayed Handle Alert, the capture suite
# asserted Handle Alert — and the generated file clicked `css:html`, because
# nothing called the renderer. Every surface agreed with every other surface
# and none of them was the generator. What no test asked was whether the
# keyword ever came out the other end.
EXPECTED = [
    "Handle Alert",
    "Input Text Into Alert",
    "Press Keys",
    "Drag And Drop",
    "Mouse Over",
    "Choose File",
    "Go To",
    "Select Frame",
    "Unselect Frame",
    "Select From List By Label",
    "Select Radio Button",
    "Select Checkbox",
    "Input Password",
    "Click Link",
    "Click Button",
    "Double Click Element",
    "Open Context Menu",
    "Unselect All From List",
]

# Read for the report at the end: what a recording still cannot express.
INTERACTION = re.compile(
    r"^(click|double click|input|press|drag|mouse|scroll|select|unselect|check|"
    r"choose|clear|submit|open|close|switch|go |reload|handle|execute|cover|"
    r"set focus|simulate|open context)", re.I)


# How the generator builds a keyword name: a verb in front, or one of these
# behind. Anything the library calls something else, a recording never will.
VERBS = ("Click", "Double Click", "Right Click", "Fill", "Check", "Uncheck",
         "Choose", "Select", "Unselect", "Clear", "Upload", "Use")
SUFFIXES = ("Should Be Enabled", "Should Be Disabled", "Text Should Be",
            "Should Contain", "Value Should Be", "Selection Should Be",
            "Should Be Selected", "Should Not Be Selected", "Should Be Set To")


def could_be_generated(name: str) -> bool:
    return (any(name == verb or name.startswith(verb + " ") for verb in VERBS)
            or any(name.endswith(suffix) for suffix in SUFFIXES))


def normalise(name: str) -> str:
    """Robot matches keyword names ignoring case, spaces and underscores."""
    return re.sub(r"[ _]", "", name).lower()


def generate(out: Path) -> None:
    """The same fixtures the parser pass uses — every element kind, every flow."""
    subprocess.run(
        ["npx", "esbuild", "scripts/fixtures.ts", "--bundle", "--format=esm",
         "--platform=node", "--alias:@=./src", f"--outfile={out / 'fixtures.mjs'}",
         "--log-level=error"],
        cwd=ROOT, check=True,
    )
    subprocess.run(["node", str(out / "fixtures.mjs")], cwd=out, check=True)


class Calls(ModelVisitor):
    """Both halves of a generated file: what it defines, and what it calls.

    A suite calls `Click Sign In` and defines it two sections above; only the
    calls inside that definition are the library's business.
    """

    def __init__(self):
        self.calls = []
        self.defined = set()

    def visit_Keyword(self, node):
        if node.name:
            self.defined.add(normalise(node.name))
        self.generic_visit(node)

    def visit_KeywordCall(self, node):
        if node.keyword:
            self.calls.append((node.keyword, list(node.args), node.lineno))

    # [Setup] and [Teardown] name a keyword too — Close Browser reaches the
    # generated suites only through a teardown, and reading calls alone said it
    # was a keyword nothing ever emitted.
    def visit_Setup(self, node):
        if node.name:
            self.calls.append((node.name, list(node.args), node.lineno))

    def visit_Teardown(self, node):
        if node.name:
            self.calls.append((node.name, list(node.args), node.lineno))


class Signature:
    """What libdoc says a keyword will accept."""

    def __init__(self, keyword):
        self.name = keyword.name
        self.required = 0
        self.positional = 0
        self.named = set()
        self.varargs = False
        self.kwargs = False
        for arg in keyword.args:
            kind = str(arg.kind)
            if kind == "VAR_POSITIONAL":
                self.varargs = True
            elif kind == "VAR_NAMED":
                self.kwargs = True
            elif kind == "NAMED_ONLY":
                self.named.add(arg.name)
                if arg.required:
                    self.required += 1
            else:
                self.positional += 1
                self.named.add(arg.name)
                if arg.required:
                    self.required += 1

    def problem(self, args: list) -> str | None:
        """None when the call fits, otherwise why it does not."""
        given_named = set()
        given_positional = 0
        for arg in args:
            match = re.match(r"^([A-Za-z_][\w ]*)=", arg)
            if match and normalise(match.group(1)) in {normalise(n) for n in self.named}:
                given_named.add(normalise(match.group(1)))
            else:
                given_positional += 1

        if given_positional + len(given_named) < self.required:
            return (f"takes {self.required} required argument(s), "
                    f"given {given_positional + len(given_named)}")
        if not self.varargs and given_positional > self.positional:
            return (f"takes {self.positional} positional argument(s), "
                    f"given {given_positional}")
        return None


def main() -> int:
    out = Path(tempfile.mkdtemp(prefix="zelector-libdoc-"))
    generate(out)

    signatures: dict[str, Signature] = {}
    versions = []
    for name in LIBRARIES:
        doc = LibraryDocumentation(name)
        versions.append(f"{doc.name} {doc.version}" if doc.version else doc.name)
        for keyword in doc.keywords:
            signatures.setdefault(normalise(keyword.name), Signature(keyword))

    emitted: dict[str, set[str]] = {}
    generated = 0
    problems = []
    files = sorted((out / "rf").glob("*.robot"))
    for path in files:
        visitor = Calls()
        visitor.visit(get_model(str(path)))
        for name, args, lineno in visitor.calls:
            key = normalise(name)
            if key in visitor.defined:
                generated += 1
                continue
            emitted.setdefault(key, set()).add(name)
            signature = signatures.get(key)
            if signature is None:
                problems.append(f"{path.name}:{lineno}  {name} — no such keyword in "
                                f"{' or '.join(LIBRARIES)}")
                continue
            why = signature.problem(args)
            if why:
                problems.append(f"{path.name}:{lineno}  {name} — {why}")

    print(f"Checked against {', '.join(versions)}.")
    print(f"{len(emitted)} library keywords across {len(files)} generated files, "
          f"plus {generated} calls to keywords the suites define themselves.\n")

    for key in sorted(emitted):
        names = emitted[key]
        # Robot does not care, but a suite that spells the same keyword two ways
        # reads as two keywords.
        flag = "  ⚠ spelled " + " / ".join(sorted(names)) if len(names) > 1 else ""
        print(f"ok    {sorted(names)[0]}{flag}")

    # The generator carries a copy of the library's keyword names so it never
    # names one of its own the same. A copy is a thing that goes stale — and it
    # goes stale differently on every machine, because the version of
    # SeleniumLibrary that installs depends on the version of Python that is
    # there. So only a name the generator could actually produce is a failure:
    # `Click Button` missing from the list is a keyword that would call itself,
    # while `Get CSS Property Value` missing from it is a name nothing here
    # would ever choose.
    committed = set(re.findall(r"^  '(.+)',$",
                               (ROOT / "src" / "core" / "library-keywords.ts").read_text(),
                               re.M))
    library_names = {k.name for k in LibraryDocumentation(LIBRARIES[0]).keywords}
    unreserved = sorted(n for n in library_names - committed if could_be_generated(n))
    if unreserved:
        problems.append(
            "src/core/library-keywords.ts does not reserve "
            f"{', '.join(unreserved)} — a recording could name a keyword that")
    other_drift = len(library_names.symmetric_difference(committed)) - len(unreserved)
    if other_drift:
        print(f"note  {other_drift} keyword name(s) differ between the committed list and "
              f"this machine's SeleniumLibrary, none of them reachable by the generator's "
              f"naming.\n")

    missing = [name for name in EXPECTED if normalise(name) not in emitted]
    for name in missing:
        problems.append(f"{name} — the fixtures cover this, and nothing emits it")

    # Not a failure. A recorder is not meant to reach every keyword in the
    # library; this is the list to read when deciding what it should reach next.
    library = LibraryDocumentation(LIBRARIES[0])
    untouched = sorted(
        k.name for k in library.keywords
        if INTERACTION.match(k.name) and normalise(k.name) not in emitted
    )
    print(f"\n{len(untouched)} interaction keywords in {library.name} that no "
          f"recording reaches:\n")
    for name in untouched:
        print(f"      {name}")

    if problems:
        print()
        for line in problems:
            print(f"FAIL  {line}")
        print(f"\n{len(problems)} problem(s).")
        return 1

    print("\nEvery emitted keyword exists and takes the arguments it is given.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
