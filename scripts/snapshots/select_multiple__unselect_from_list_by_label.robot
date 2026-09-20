*** Variables ***
# fastest for the browser to resolve
${TAG_LIST}             id:tag-list

*** Keywords ***
Unselect Tag List
    Wait Until Element Is Visible    ${TAG_LIST}    timeout=10s
    Unselect From List By Label    ${TAG_LIST}    @{LABELS}
