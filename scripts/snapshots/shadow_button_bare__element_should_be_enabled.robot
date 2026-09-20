# ⚠ This element lives inside a shadow root. SeleniumLibrary 6.9 has no
#   locator strategy that pierces shadow boundaries, so a dom: expression
#   is the supported workaround.
*** Variables ***
# SeleniumLibrary has no shadow-DOM strategy — a dom: expression is the only way in
${BUTTON}               dom:document.querySelector('sl-button[title="Press \\\\ to toggle"]').shadowRoot.querySelector('button[type="button"]')

*** Keywords ***
Button Should Be Enabled
    Wait Until Element Is Visible    ${BUTTON}    timeout=10s
    Element Should Be Enabled    ${BUTTON}
