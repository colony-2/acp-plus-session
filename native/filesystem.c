// POSIX descriptor-relative filesystem access. Built with the package, never downloaded.
#define _POSIX_C_SOURCE 200809L
#include <node_api.h>
#include <uv.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <dirent.h>
#include <unistd.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>

static napi_value failure(napi_env env, const char *operation, int error) {
  napi_throw_error(env, uv_err_name(-error), operation);
  return NULL;
}
static napi_value open_at(napi_env env, napi_callback_info info) {
  size_t argc = 4, length = 0;
  napi_value argv[4], result;
  int32_t parent, flags, mode;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 4 ||
      napi_get_value_int32(env, argv[0], &parent) != napi_ok ||
      napi_get_value_int32(env, argv[2], &flags) != napi_ok ||
      napi_get_value_int32(env, argv[3], &mode) != napi_ok ||
      napi_get_value_string_utf8(env, argv[1], NULL, 0, &length) != napi_ok ||
      length == 0 || length > 4096) return failure(env, "Invalid descriptor-relative open", EINVAL);
  char *name = malloc(length + 1);
  if (!name) return failure(env, "Allocate component", ENOMEM);
  size_t written;
  if (napi_get_value_string_utf8(env, argv[1], name, length + 1, &written) != napi_ok ||
      written != length || strlen(name) != length || strchr(name, '/') ||
      !strcmp(name, ".") || !strcmp(name, "..")) {
    free(name); return failure(env, "Invalid path component", EINVAL);
  }
  int fd = openat(parent, name, flags | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK, (mode_t)mode);
  int saved = errno;
  free(name);
  if (fd < 0) return failure(env, "Descriptor-relative open failed", saved);
  if (napi_create_int32(env, fd, &result) != napi_ok) {
    close(fd); return failure(env, "Return descriptor", ENOMEM);
  }
  return result;
}
typedef struct { DIR *directory; } cursor;
static void finalize_cursor(napi_env env, void *data, void *hint) {
  (void)env; (void)hint;
  cursor *value = data;
  if (value->directory) closedir(value->directory);
  free(value);
}
static napi_value open_directory(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1], result;
  int32_t parent;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 1 ||
      napi_get_value_int32(env, argv[0], &parent) != napi_ok) return failure(env, "Invalid directory descriptor", EINVAL);
  // A fresh open-file description avoids sharing/reusing directory offsets.
  int fd = openat(parent, ".", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (fd < 0) return failure(env, "Open directory cursor", errno);
  DIR *directory = fdopendir(fd);
  if (!directory) { int saved = errno; close(fd); return failure(env, "Open directory stream", saved); }
  cursor *value = malloc(sizeof(*value));
  if (!value) { closedir(directory); return failure(env, "Allocate directory cursor", ENOMEM); }
  value->directory = directory;
  if (napi_create_external(env, value, finalize_cursor, NULL, &result) != napi_ok) {
    finalize_cursor(env, value, NULL); return failure(env, "Return directory cursor", ENOMEM);
  }
  return result;
}
static cursor *get_cursor(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  void *value;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 1 ||
      napi_get_value_external(env, argv[0], &value) != napi_ok) {
    failure(env, "Invalid directory cursor", EINVAL); return NULL;
  }
  return value;
}
static napi_value next_directory(napi_env env, napi_callback_info info) {
  cursor *value = get_cursor(env, info);
  if (!value) return NULL;
  if (!value->directory) return failure(env, "Closed directory cursor", EBADF);
  napi_value result;
  for (;;) {
    errno = 0;
    struct dirent *entry = readdir(value->directory);
    if (!entry) {
      int saved = errno;
      if (saved) return failure(env, "Read directory", saved);
      napi_get_null(env, &result); return result;
    }
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    if (napi_create_string_utf8(env, entry->d_name, NAPI_AUTO_LENGTH, &result) != napi_ok) return failure(env, "Allocate directory entry", ENOMEM);
    return result;
  }
}
static napi_value close_directory(napi_env env, napi_callback_info info) {
  cursor *value = get_cursor(env, info);
  if (!value) return NULL;
  if (value->directory) { closedir(value->directory); value->directory = NULL; }
  napi_value result;
  napi_get_undefined(env, &result); return result;
}
static napi_value initialize(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    { "openAt", NULL, open_at, NULL, NULL, NULL, napi_default, NULL },
    { "openDirectory", NULL, open_directory, NULL, NULL, NULL, napi_default, NULL },
    { "nextDirectory", NULL, next_directory, NULL, NULL, NULL, napi_default, NULL },
    { "closeDirectory", NULL, close_directory, NULL, NULL, NULL, napi_default, NULL }
  };
  if (napi_define_properties(env, exports, 4, properties) != napi_ok) return NULL;
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
