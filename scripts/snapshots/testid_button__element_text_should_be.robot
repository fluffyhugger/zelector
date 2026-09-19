*** Variables ***
# dedicated test hook — the most durable locator available
${CONFIRM_ORDER}        data:testid:confirm-order

*** Keywords ***
Confirm Order Text Should Be
    Wait Until Element Is Visible    ${CONFIRM_ORDER}    timeout=10s
    Element Text Should Be    ${CONFIRM_ORDER}    ${EXPECTED}
