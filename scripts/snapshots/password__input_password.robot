*** Variables ***
# fastest for the browser to resolve
${LOGIN_PW}             id:login-pw

*** Keywords ***
Fill Login Pw
    Wait Until Element Is Visible    ${LOGIN_PW}    timeout=10s
    Input Password    ${LOGIN_PW}    ${PASSWORD}
