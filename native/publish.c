// Atomic directory publication. Built with the package, never at session startup.
#define _GNU_SOURCE
#include <stdio.h>
#include <errno.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#ifdef __linux__
#include <sys/syscall.h>
#include <linux/fs.h>
#endif
#ifdef __APPLE__
#include <sys/attr.h>
#endif
int main(int argc, char **argv) {
  if (argc != 3) return 64;
  int result;
#ifdef __linux__
  result = syscall(SYS_renameat2, AT_FDCWD, argv[1], AT_FDCWD, argv[2], RENAME_NOREPLACE);
#elif defined(__APPLE__)
  result = renamex_np(argv[1], argv[2], RENAME_EXCL);
#else
  errno = ENOSYS; result = -1;
#endif
  if (result == 0) return 0;
  if (errno == EEXIST || errno == ENOTEMPTY) return 10;
  fprintf(stderr, "atomic publish: %s\n", strerror(errno));
  return 11;
}
