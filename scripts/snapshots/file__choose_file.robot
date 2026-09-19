*** Variables ***
# fastest for the browser to resolve
${AVATAR}               id:avatar

*** Keywords ***
Upload Avatar
    Wait Until Element Is Visible    ${AVATAR}    timeout=10s
    Choose File    ${AVATAR}    ${FILE_PATH}
