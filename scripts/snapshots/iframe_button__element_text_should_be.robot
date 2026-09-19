*** Variables ***
${CHECKOUT_FRAME}       id:checkout-frame
# fastest for the browser to resolve
${PAY_NOW}              id:pay-now

*** Keywords ***
Pay Now Text Should Be
    Select Frame    ${CHECKOUT_FRAME}
    Wait Until Element Is Visible    ${PAY_NOW}    timeout=10s
    Element Text Should Be    ${PAY_NOW}    ${EXPECTED}
    Unselect Frame
