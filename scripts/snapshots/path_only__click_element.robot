*** Variables ***
# no stable attribute found — consider asking for a data-testid
${TOTAL}                css:main > div:nth-of-type(3)

*** Keywords ***
Click Total
    Wait Until Element Is Visible    ${TOTAL}    timeout=10s
    Click Element    ${TOTAL}
