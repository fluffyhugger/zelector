# ⚠ This element lives inside a shadow root. SeleniumLibrary 6.9 has no
#   locator strategy that pierces shadow boundaries, so a dom: expression
#   is the supported workaround.
*** Variables ***
${OUTER_FRAME}          id:outer-frame
# SeleniumLibrary has no shadow-DOM strategy — a dom: expression is the only way in
${CONFIRM}              dom:document.querySelector('pay-widget').shadowRoot.querySelector('button.confirm')

*** Keywords ***
Confirm Text Should Be
    Select Frame    ${OUTER_FRAME}
    Wait Until Element Is Visible    ${CONFIRM}    timeout=10s
    Element Text Should Be    ${CONFIRM}    ${EXPECTED}
    Unselect Frame
