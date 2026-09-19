*** Variables ***
# Select Radio Button takes the group name and the button's value — not a locator
${SHIP_EXPRESS_GROUP}    shipping_method
${SHIP_EXPRESS_VALUE}    express

*** Keywords ***
Choose Ship Express
    Wait Until Page Contains Element    name:shipping_method    timeout=10s
    Select Radio Button    ${SHIP_EXPRESS_GROUP}    ${SHIP_EXPRESS_VALUE}
