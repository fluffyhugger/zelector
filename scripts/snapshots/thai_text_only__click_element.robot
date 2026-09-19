*** Variables ***
# no stable attribute found — consider asking for a data-testid
${ราคารวมทั้งหมด}         css:span

*** Keywords ***
Click ราคารวมทั้งหมด
    Wait Until Element Is Visible    ${ราคารวมทั้งหมด}    timeout=10s
    Click Element    ${ราคารวมทั้งหมด}
