*** Variables ***
# dedicated test hook — the most durable locator available
${ACCEPT_TERMS}         data:cy:accept-terms

*** Keywords ***
Check Accept Terms
    Wait Until Element Is Visible    ${ACCEPT_TERMS}    timeout=10s
    Select Checkbox    ${ACCEPT_TERMS}
