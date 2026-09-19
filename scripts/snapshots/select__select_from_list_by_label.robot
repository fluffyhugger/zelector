*** Variables ***
# fastest for the browser to resolve
${COUNTRY_SELECT}       id:country-select

*** Keywords ***
Select Country Select
    Wait Until Element Is Visible    ${COUNTRY_SELECT}    timeout=10s
    Select From List By Label    ${COUNTRY_SELECT}    ${LABEL}
