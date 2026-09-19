*** Variables ***
${CHECKOUT_FRAME}       id:checkout-frame
# fastest for the browser to resolve
${PAY_NOW}              id:pay-now

*** Keywords ***
Pay Now Should Be Enabled
    Select Frame    ${CHECKOUT_FRAME}
    Wait Until Element Is Visible    ${PAY_NOW}    timeout=10s
    Element Should Be Enabled    ${PAY_NOW}
    Unselect Frame
