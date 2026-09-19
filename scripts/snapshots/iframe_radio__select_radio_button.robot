*** Variables ***
# Select Radio Button takes the group name and the button's value — not a locator
${VISA_GROUP}           card_type
${VISA_VALUE}           visa

*** Keywords ***
Choose Visa
    Wait Until Page Contains Element    name:card_type    timeout=10s
    Select Radio Button    ${VISA_GROUP}    ${VISA_VALUE}
