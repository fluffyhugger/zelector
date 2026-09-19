*** Variables ***
${FRAME}                css:iframe[src*="/pay"]
# form field name — tied to the backend contract · ⚠ the frame selector is a guess — a cross-origin parent hides the real one
${CARD_NUMBER}          name:card_number

*** Keywords ***
Fill Card Number
    Select Frame    ${FRAME}
    Wait Until Element Is Visible    ${CARD_NUMBER}    timeout=10s
    Input Text    ${CARD_NUMBER}    ${TEXT}
    Unselect Frame
