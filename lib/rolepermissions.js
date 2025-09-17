/**
 *
 */

const { WellKnownRoles, makePermissionFlag, allPermissions } = require('node-opcua');

module.exports = function() {
  return [
    {
      roleId: WellKnownRoles.Anonymous,
      permissions: allPermissions
    },
    {
      roleId: WellKnownRoles.AuthenticatedUser,
      permissions: makePermissionFlag('Browse | Read | ReadHistory | ReceiveEvents')
    },
    {
      roleId: WellKnownRoles.ConfigureAdmin,
      permissions: makePermissionFlag('Browse | ReadRolePermissions | Read | ReadHistory | ReceiveEvents | Write')
    },
    {
      roleId: WellKnownRoles.SecurityAdmin,
      permissions: allPermissions
    }
  ];
};
