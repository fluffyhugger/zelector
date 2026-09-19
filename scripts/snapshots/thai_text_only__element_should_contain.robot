*** Variables ***
# no stable attribute found — consider asking for a data-testid
${ราคารวมทั้งหมด}         css:span

*** Keywords ***
ราคารวมทั้งหมด Should Contain
    Wait Until Element Is Visible    ${ราคารวมทั้งหมด}    timeout=10s
    Element Should Contain    ${ราคารวมทั้งหมด}    ${EXPECTED}
