*** Variables ***
# no stable attribute found — consider asking for a data-testid
${VIEW_PROFILE}         css:a[href="/users/3"]

*** Keywords ***
View Profile Should Contain
    Wait Until Element Is Visible    ${VIEW_PROFILE}    timeout=10s
    Element Should Contain    ${VIEW_PROFILE}    ${EXPECTED}
