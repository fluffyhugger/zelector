*** Variables ***
# dedicated test hook — the most durable locator available
${CONFIRM_ORDER}        data:testid:confirm-order

*** Keywords ***
Confirm Order Should Be Enabled
    Wait Until Element Is Visible    ${CONFIRM_ORDER}    timeout=10s
    Element Should Be Enabled    ${CONFIRM_ORDER}
