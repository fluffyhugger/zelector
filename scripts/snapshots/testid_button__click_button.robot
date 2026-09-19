*** Variables ***
# dedicated test hook — the most durable locator available
${CONFIRM_ORDER}        data:testid:confirm-order

*** Keywords ***
Click Confirm Order
    Wait Until Element Is Visible    ${CONFIRM_ORDER}    timeout=10s
    Click Button    ${CONFIRM_ORDER}
