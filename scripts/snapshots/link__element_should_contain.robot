*** Variables ***
# ⚠ breaks on copy edits and in other locales
${TERMS_OF_SERVICE}     link:Terms of Service

*** Keywords ***
Terms Of Service Should Contain
    Wait Until Element Is Visible    ${TERMS_OF_SERVICE}    timeout=10s
    Element Should Contain    ${TERMS_OF_SERVICE}    ${EXPECTED}
