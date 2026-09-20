*** Variables ***
# fastest for the browser to resolve
${TAG_LIST}             id:tag-list

*** Keywords ***
Tag List Selection Should Be
    Wait Until Element Is Visible    ${TAG_LIST}    timeout=10s
    List Selection Should Be    ${TAG_LIST}    @{LABELS}
