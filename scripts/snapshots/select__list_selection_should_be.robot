*** Variables ***
# fastest for the browser to resolve
${COUNTRY_SELECT}       id:country-select

*** Keywords ***
Country Select Selection Should Be
    Wait Until Element Is Visible    ${COUNTRY_SELECT}    timeout=10s
    List Selection Should Be    ${COUNTRY_SELECT}    ${LABEL}
