*** Variables ***
# ⚠ breaks on copy edits and in other locales
${TERMS_OF_SERVICE}     link:Terms of Service

*** Keywords ***
Click Terms Of Service
    Wait Until Element Is Visible    ${TERMS_OF_SERVICE}    timeout=10s
    Click Link    ${TERMS_OF_SERVICE}
