# ⚠ This element lives inside a shadow root. SeleniumLibrary 6.9 has no
#   locator strategy that pierces shadow boundaries, so a dom: expression
#   is the supported workaround.
*** Variables ***
# SeleniumLibrary has no shadow-DOM strategy — a dom: expression is the only way in
${PAY_NOW}              dom:document.querySelector('checkout-widget').shadowRoot.querySelector('button.pay-btn')

*** Keywords ***
Pay Now Text Should Be
    Wait Until Element Is Visible    ${PAY_NOW}    timeout=10s
    Element Text Should Be    ${PAY_NOW}    ${EXPECTED}
