*** Variables ***
${CHECKOUT_FRAME}       id:checkout-frame
# fastest for the browser to resolve
${PAY_NOW}              id:pay-now

*** Keywords ***
Click Pay Now
    Select Frame    ${CHECKOUT_FRAME}
    Wait Until Element Is Visible    ${PAY_NOW}    timeout=10s
    Click Button    ${PAY_NOW}
    Unselect Frame
