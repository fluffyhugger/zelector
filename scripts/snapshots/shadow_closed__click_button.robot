# ⚠ This element lives inside a shadow root. SeleniumLibrary 6.9 has no
#   locator strategy that pierces shadow boundaries, so a dom: expression
#   is the supported workaround.
*** Variables ***
# SeleniumLibrary has no shadow-DOM strategy — a dom: expression is the only way in
${PAY_NOW}              dom:document.querySelector('checkout-widget')?.shadowRoot?.querySelector('button.pay-btn')

*** Keywords ***
Click Pay Now
    Wait Until Element Is Visible    ${PAY_NOW}    timeout=10s
    Click Button    ${PAY_NOW}
