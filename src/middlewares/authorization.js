const MASTER_PERMISSION = 'SYSTEM_OWNER';

function canAny(requiredPermissions) {
  const required = Array.isArray(requiredPermissions)
    ? requiredPermissions
    : [requiredPermissions];

  return (req, res, next) => {
    const permissions = req.user?.permissions || [];

    // 🔥 bypass total
    if (permissions.includes(MASTER_PERMISSION)) {
      return next();
    }

    const hasAny = required.some(p => permissions.includes(p));

    if (!hasAny) {
      return res.status(403).json({
        error: true,
        message: 'Permission denied'
      });
    }
    next();
  };
}

function canAll(requiredPermissions = []) {
  return (req, res, next) => {
    const userPermissions = req.user?.permissions || [];

    if (userPermissions.includes(MASTER_PERMISSION)) {
      return next();
    }

    const permissionsArray = Array.isArray(requiredPermissions)
      ? requiredPermissions
      : [requiredPermissions];

    const hasAll = permissionsArray.every(permission =>
      userPermissions.includes(permission)
    );

    if (!hasAll) {
      return res.status(403).json({
        error: true,
        message: 'Permission denied'
      });
    }

    next();
  };
}

module.exports ={
    canAll,
    canAny
}