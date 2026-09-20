*** Variables ***
# ⚠ test hook carrying a record id — another environment will have a different one
${PRODUCT}              data:test:product-01M2ZB0KTWNEAT0VYMPH5FYPDY

*** Keywords ***
Click Product
    Wait Until Element Is Visible    ${PRODUCT}    timeout=10s
    Click Link    ${PRODUCT}
