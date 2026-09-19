*** Variables ***
# fastest for the browser to resolve
${LOGIN_PW}             id:login-pw

*** Keywords ***
Login Pw Should Be Disabled
    Wait Until Element Is Visible    ${LOGIN_PW}    timeout=10s
    Element Should Be Disabled    ${LOGIN_PW}
