*** Variables ***
${FRAME}                css:iframe[src*="/pay"]
# form field name — tied to the backend contract · ⚠ the frame selector is a guess — a cross-origin parent hides the real one
${CARD_NUMBER}          name:card_number

*** Keywords ***
Card Number Value Should Be
    Select Frame    ${FRAME}
    Wait Until Element Is Visible    ${CARD_NUMBER}    timeout=10s
    Textfield Value Should Be    ${CARD_NUMBER}    ${EXPECTED}
    Unselect Frame
