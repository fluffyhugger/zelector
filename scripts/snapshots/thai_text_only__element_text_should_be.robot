*** Variables ***
# no stable attribute found — consider asking for a data-testid
${ราคารวมทั้งหมด}         css:span

*** Keywords ***
ราคารวมทั้งหมด Text Should Be
    Wait Until Element Is Visible    ${ราคารวมทั้งหมด}    timeout=10s
    Element Text Should Be    ${ราคารวมทั้งหมด}    ${EXPECTED}
