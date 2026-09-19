*** Variables ***
# dedicated test hook — the most durable locator available
${CONFIRM_ORDER}        data:testid:confirm-order

*** Keywords ***
Confirm Order Should Be Disabled
    Wait Until Element Is Visible    ${CONFIRM_ORDER}    timeout=10s
    Element Should Be Disabled    ${CONFIRM_ORDER}
