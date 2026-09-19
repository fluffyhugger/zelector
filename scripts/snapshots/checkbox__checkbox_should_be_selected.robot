*** Variables ***
# dedicated test hook — the most durable locator available
${ACCEPT_TERMS}         data:cy:accept-terms

*** Keywords ***
Accept Terms Should Be Selected
    Wait Until Element Is Visible    ${ACCEPT_TERMS}    timeout=10s
    Checkbox Should Be Selected    ${ACCEPT_TERMS}
