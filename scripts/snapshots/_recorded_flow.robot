*** Settings ***
Library           SeleniumLibrary

*** Variables ***
# fastest for the browser to resolve
${USERNAME}             id:username
# fastest for the browser to resolve
${PASSWORD}             id:password
# fastest for the browser to resolve
${SIGN_IN}              id:sign-in
# no stable attribute found — consider asking for a data-testid
${LOADING_SPINNER}      css:.loading-spinner
# form field name — tied to the backend contract
${STATUS}               name:status
# fastest for the browser to resolve
${ORDERS}               id:orders
# form field name — tied to the backend contract
${TAGS}                 name:tags
# dedicated test hook — the most durable locator available
${SELECT_ALL}           data:testid:select-all
# fastest for the browser to resolve
${SHIP_X}               id:ship-x
# fastest for the browser to resolve
${COMPANY_CELL}         id:company-cell
# dedicated test hook — the most durable locator available
${ORDER_ROW}            data:testid:order-row
# dedicated test hook — the most durable locator available
${ORDER_TOTAL}          data:testid:order-total
# ⚠ breaks on copy edits and in other locales
${MY_ORDERS}            link:My Orders
# radio group's name attribute
${SHIP_X_GROUP}         shipping
${SHIP_X_VALUE}         express
# recorded navigation
${URL}                  https://shop.example.com/receipt
${BROWSER}              chrome
${START_URL}            https://shop.example.com/login

*** Test Cases ***
Order Is Shipped After Checkout
    [Documentation]    Signs in, filters to shipped orders and checks the total against \${EXPECTED}.
    Open Browser    ${START_URL}    ${BROWSER}
    Maximize Browser Window
    Fill Username    somebody@example.com
    Fill Password    hunter2\ \ \${NOT_A_VAR}
    Wait Until Element Is Not Visible    ${LOADING_SPINNER}    timeout=15s
    Click Sign In
    Wait Until Location Contains    /dashboard    timeout=20s
    Click My Orders
    Wait Until Page Contains Element    ${ORDERS}    timeout=10s
    Select Status    Shipped
    Select Tags    Urgent    Back\ \ order
    Sleep    2s
    Check Select All
    Choose Ship X
    Click Sign In
    Double Click Company Cell
    Right Click Order Row
    Go To    ${URL}
    Order Total Text Should Be    ฿1,240.00
    [Teardown]    Close Browser

*** Keywords ***
Fill Username
    [Arguments]    ${arg_text}
    Wait Until Element Is Visible    ${USERNAME}    timeout=10s
    Input Text    ${USERNAME}    ${arg_text}

Fill Password
    [Arguments]    ${arg_password}
    Wait Until Element Is Visible    ${PASSWORD}    timeout=10s
    Input Password    ${PASSWORD}    ${arg_password}

Click Sign In
    Wait Until Element Is Visible    ${SIGN_IN}    timeout=10s
    Click Button    ${SIGN_IN}

Click My Orders
    Wait Until Element Is Visible    ${MY_ORDERS}    timeout=10s
    Click Link    ${MY_ORDERS}

Select Status
    [Arguments]    ${arg_label}
    Wait Until Element Is Visible    ${STATUS}    timeout=10s
    Select From List By Label    ${STATUS}    ${arg_label}

Select Tags
    [Arguments]    @{arg_labels}
    Wait Until Element Is Visible    ${TAGS}    timeout=10s
    Select From List By Label    ${TAGS}    @{arg_labels}

Check Select All
    Wait Until Element Is Visible    ${SELECT_ALL}    timeout=10s
    Select Checkbox    ${SELECT_ALL}

Choose Ship X
    Wait Until Element Is Enabled    ${SHIP_X}    timeout=10s
    Select Radio Button    ${SHIP_X_GROUP}    ${SHIP_X_VALUE}

Double Click Company Cell
    Wait Until Element Is Visible    ${COMPANY_CELL}    timeout=10s
    Double Click Element    ${COMPANY_CELL}

Right Click Order Row
    Wait Until Element Is Visible    ${ORDER_ROW}    timeout=10s
    Open Context Menu    ${ORDER_ROW}

Order Total Text Should Be
    [Arguments]    ${arg_expected}
    Wait Until Element Is Visible    ${ORDER_TOTAL}    timeout=10s
    Element Text Should Be    ${ORDER_TOTAL}    ${arg_expected}
