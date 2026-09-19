*** Variables ***
# dedicated test hook — the most durable locator available
${ACCEPT_TERMS}         data:cy:accept-terms

*** Keywords ***
Uncheck Accept Terms
    Wait Until Element Is Visible    ${ACCEPT_TERMS}    timeout=10s
    Unselect Checkbox    ${ACCEPT_TERMS}
