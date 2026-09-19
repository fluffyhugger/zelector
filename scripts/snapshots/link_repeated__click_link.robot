*** Variables ***
# no stable attribute found — consider asking for a data-testid
${VIEW_PROFILE}         css:a[href="/users/3"]

*** Keywords ***
Click View Profile
    Wait Until Element Is Visible    ${VIEW_PROFILE}    timeout=10s
    Click Link    ${VIEW_PROFILE}
