*** Variables ***
# Radio Button Should Be Set To takes the group name and the button's value — not a locator
${SHIP_EXPRESS_GROUP}    shipping_method
${SHIP_EXPRESS_VALUE}    express

*** Keywords ***
Ship Express Should Be Set To
    Wait Until Page Contains Element    name:shipping_method    timeout=10s
    Radio Button Should Be Set To    ${SHIP_EXPRESS_GROUP}    ${SHIP_EXPRESS_VALUE}
