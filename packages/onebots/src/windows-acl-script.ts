/** 只负责构建受保护的继承 ACL；调用方分别声明 ownerSid 与 allowedSids 安全策略。 */
export const protectedWindowsDirectoryAclScript = String.raw`
$acl=New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
$inherit=[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
$prop=[System.Security.AccessControl.PropagationFlags]::None
$allow=[System.Security.AccessControl.AccessControlType]::Allow
foreach($identity in $allowedSids){
  $principal=New-Object System.Security.Principal.SecurityIdentifier($identity)
  $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($principal,'FullControl',$inherit,$prop,$allow)
  $acl.AddAccessRule($rule)|Out-Null
}
$acl.SetOwner((New-Object System.Security.Principal.SecurityIdentifier($ownerSid)))
`;
