*** Variables ***
# ⚠ breaks on copy edits and in other locales
${TERMS_OF_SERVICE}     link:Terms of Service

*** Keywords ***
Terms Of Service Text Should Be
    Wait Until Element Is Visible    ${TERMS_OF_SERVICE}    timeout=10s
    Element Text Should Be    ${TERMS_OF_SERVICE}    ${EXPECTED}
