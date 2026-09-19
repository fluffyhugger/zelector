*** Variables ***
# fastest for the browser to resolve
${COUNTRY_SELECT}       id:country-select

*** Keywords ***
Country Select Should Be Disabled
    Wait Until Element Is Visible    ${COUNTRY_SELECT}    timeout=10s
    Element Should Be Disabled    ${COUNTRY_SELECT}
