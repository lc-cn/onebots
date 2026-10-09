const POWERSHELL_EXPRESSION = /^(?:\$[A-Za-z][A-Za-z0-9_.]*|'S-1-(?:[0-9]+-)+[0-9]+')$/;

function expression(value: string): string {
    if (!POWERSHELL_EXPRESSION.test(value)) throw new Error("Windows ACL 身份表达式无效");
    return value;
}

/** 生成由调用方固定身份组成的 ACL 变量；不得传入用户输入。 */
export function windowsAclPrincipals(
    ownerExpression: string,
    allowedExpressions: readonly string[],
): string {
    const owner = expression(ownerExpression);
    const allowed = allowedExpressions.map(expression).join(",");
    if (!allowed) throw new Error("Windows ACL 至少需要一个授权身份");
    return `$ownerSid=${owner}\n$allowedSids=@(${allowed})|Sort-Object -Unique`;
}

/** 构造受保护的 FullControl ACL；调用方决定原子创建还是应用到既有对象。 */
export function windowsFullControlAclBuilder(kind: "directory" | "file"): string {
    const security = kind === "directory" ? "DirectorySecurity" : "FileSecurity";
    const inheritance =
        kind === "directory"
            ? "[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'"
            : "[System.Security.AccessControl.InheritanceFlags]::None";
    return `$acl=New-Object System.Security.AccessControl.${security}
$acl.SetAccessRuleProtection($true,$false)
$inherit=${inheritance}
$prop=[System.Security.AccessControl.PropagationFlags]::None
$allow=[System.Security.AccessControl.AccessControlType]::Allow
foreach($identity in $allowedSids){
  $principal=New-Object System.Security.Principal.SecurityIdentifier($identity)
  $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($principal,'FullControl',$inherit,$prop,$allow)
  $acl.AddAccessRule($rule)|Out-Null
}
$acl.SetOwner((New-Object System.Security.Principal.SecurityIdentifier($ownerSid)))`;
}

/** 核验 owner、允许身份、继承和权限均与同一闭合策略一致。 */
export function windowsFullControlAclVerifier(
    kind: "directory" | "file",
    allowInherited = false,
): string {
    const inheritance =
        kind === "directory"
            ? "[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'"
            : "[System.Security.AccessControl.InheritanceFlags]::None";
    const inherited = allowInherited
        ? "$legalInheritance=(-not $check.AreAccessRulesProtected -and $inheritedCount -eq $allowedSids.Count)\n$protectionOk=($legalInheritance -or ($check.AreAccessRulesProtected -and $inheritedCount -eq 0))"
        : "$protectionOk=($check.AreAccessRulesProtected -and $inheritedCount -eq 0)";
    return `$rules=@($check.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]))
$ids=@($rules|ForEach-Object{$_.IdentityReference.Value}|Sort-Object -Unique)
$owner=$check.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
$inherit=${inheritance}
$prop=[System.Security.AccessControl.PropagationFlags]::None
$bad=@($rules|Where-Object{$_.AccessControlType -ne 'Allow' -or $_.InheritanceFlags -ne $inherit -or $_.PropagationFlags -ne $prop -or $_.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl})
$inheritedCount=@($rules|Where-Object{$_.IsInherited}).Count
${inherited}
if(-not $protectionOk -or $owner -ne $ownerSid -or $rules.Count -ne $allowedSids.Count -or $ids.Count -ne $allowedSids.Count -or @($ids|Where-Object{$_ -notin $allowedSids}).Count -ne 0 -or $bad.Count -ne 0){throw 'unsafe acl'}`;
}
