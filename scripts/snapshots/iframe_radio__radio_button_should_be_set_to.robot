*** Variables ***
# Radio Button Should Be Set To takes the group name and the button's value — not a locator
${VISA_GROUP}           card_type
${VISA_VALUE}           visa

*** Keywords ***
Visa Should Be Set To
    Wait Until Page Contains Element    name:card_type    timeout=10s
    Radio Button Should Be Set To    ${VISA_GROUP}    ${VISA_VALUE}
