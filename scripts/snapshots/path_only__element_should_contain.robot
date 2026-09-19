*** Variables ***
# no stable attribute found — consider asking for a data-testid
${TOTAL}                css:main > div:nth-of-type(3)

*** Keywords ***
Total Should Contain
    Wait Until Element Is Visible    ${TOTAL}    timeout=10s
    Element Should Contain    ${TOTAL}    ${EXPECTED}
