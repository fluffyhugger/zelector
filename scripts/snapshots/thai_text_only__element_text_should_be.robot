*** Variables ***
# no stable attribute found — consider asking for a data-testid
${SPAN_TARGET}          css:span

*** Keywords ***
Span Target Text Should Be
    Wait Until Element Is Visible    ${SPAN_TARGET}    timeout=10s
    Element Text Should Be    ${SPAN_TARGET}    ${EXPECTED}
