*** Variables ***
${FRAME}                css:iframe[src*="/pay"]
# form field name — tied to the backend contract · ⚠ the frame selector is a guess — a cross-origin parent hides the real one
${CARD_NUMBER}          name:card_number

*** Keywords ***
Card Number Should Be Disabled
    Select Frame    ${FRAME}
    Wait Until Element Is Visible    ${CARD_NUMBER}    timeout=10s
    Element Should Be Disabled    ${CARD_NUMBER}
    Unselect Frame
