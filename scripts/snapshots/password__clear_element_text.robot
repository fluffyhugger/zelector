*** Variables ***
# fastest for the browser to resolve
${LOGIN_PW}             id:login-pw

*** Keywords ***
Clear Login Pw
    Wait Until Element Is Visible    ${LOGIN_PW}    timeout=10s
    Clear Element Text    ${LOGIN_PW}
