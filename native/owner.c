// Linux process owner. Built at package construction, never at runtime.
// FD 3 is a private readiness/completion channel; it is closed before executing children.
#define _GNU_SOURCE
#include <sys/prctl.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <unistd.h>
#include <signal.h>
#include <time.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <fcntl.h>
#include <string.h>

static volatile sig_atomic_t requested_signal;
static volatile sig_atomic_t force_stop;
static void request_stop(int sig) {
  if (sig == SIGUSR1) force_stop = 1;
  requested_signal = sig;
}
static long long milliseconds(void) {
  struct timespec t;
  if (clock_gettime(CLOCK_MONOTONIC, &t) < 0) { perror("clock_gettime"); exit(125); }
  return (long long)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}

// Only direct children are signaled. As parents exit, the kernel reparents
// their descendants to this subreaper, including detached process groups.
// They remain children/zombies until this single-threaded loop reaps them,
// preventing PID reuse between enumeration and signaling.
static int signal_children(int sig) {
  char path[128];
  snprintf(path, sizeof(path), "/proc/self/task/%ld/children", (long)getpid());
  FILE *f = fopen(path, "r");
  if (!f) { perror("open children"); return -1; }
  long pid;
  while (fscanf(f, "%ld", &pid) == 1) {
    if (pid > 0 && kill((pid_t)pid, sig) < 0 && errno != ESRCH) {
      perror("kill child"); fclose(f); return -1;
    }
  }
  int failed = ferror(f);
  fclose(f);
  return failed ? -1 : 0;
}

int main(int argc, char **argv) {
  if (argc >= 4 && !strcmp(argv[1], "--cwd-fd") && !strcmp(argv[2], "4")) {
    if (fchdir(4) < 0 || close(4) < 0) { perror("owned cwd"); return 125; }
    argv += 2; argc -= 2;
  }
  if (argc < 2 || prctl(PR_SET_CHILD_SUBREAPER, 1) < 0) { perror("subreaper"); return 125; }
  pid_t original_parent = getppid();
  umask(0077);
  if (fcntl(3, F_SETFD, FD_CLOEXEC) < 0) { perror("completion channel"); return 125; }
  struct sigaction action = {0};
  action.sa_handler = request_stop;
  sigemptyset(&action.sa_mask);
  if (sigaction(SIGTERM, &action, NULL) < 0 || sigaction(SIGINT, &action, NULL) < 0 || sigaction(SIGHUP, &action, NULL) < 0 || sigaction(SIGUSR1, &action, NULL) < 0) { perror("sigaction"); return 125; }
  if (prctl(PR_SET_PDEATHSIG, SIGTERM) < 0) { perror("parent death signal"); return 125; }
  if (getppid() != original_parent || getppid() == 1) requested_signal = SIGTERM;
  if (write(3, "R", 1) != 1) return 125;
  pid_t leader = fork();
  if (leader < 0) { perror("fork"); return 125; }
  if (leader == 0) {
    close(3);
    signal(SIGTERM, SIG_DFL); signal(SIGINT, SIG_DFL); signal(SIGHUP, SIG_DFL); signal(SIGUSR1, SIG_DFL);
    execvp(argv[1], argv + 1); perror("execvp"); _exit(126);
  }
  int leader_status = 0, leader_done = 0, status;
  long long stopping_at = 0;
  for (;;) {
    pid_t child;
    while ((child = waitpid(-1, &status, WNOHANG)) > 0) {
      /* waitpid confirms each writer is reaped, including detached descendants. */
      if (child == leader) { leader_status = status; leader_done = 1; }
    }
    if (child == -1 && errno == ECHILD) break;
    if (child == -1 && errno != EINTR) { perror("waitpid"); return 125; }
    if (leader_done || requested_signal) {
      if (!stopping_at) stopping_at = milliseconds();
      long long elapsed = milliseconds() - stopping_at;
      if (signal_children(force_stop || elapsed >= 10000 ? SIGKILL : SIGTERM) < 0) return 125;
      if (elapsed >= 20000) { fprintf(stderr, "session-owner: unconfirmed descendant exit\n"); return 125; }
    }
    struct timespec tick = { .tv_sec = 0, .tv_nsec = 10000000 };
    nanosleep(&tick, NULL);
  }
  if (write(3, "Q", 1) != 1) return 125;
  close(3);
  if (requested_signal) return 128 + requested_signal;
  return WIFEXITED(leader_status) ? WEXITSTATUS(leader_status) : 128 + WTERMSIG(leader_status);
}
