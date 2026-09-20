*** Variables ***
# fastest for the browser to resolve
${TAG_LIST}             id:tag-list

*** Keywords ***
Clear Tag List
    Wait Until Element Is Visible    ${TAG_LIST}    timeout=10s
    Unselect All From List    ${TAG_LIST}
