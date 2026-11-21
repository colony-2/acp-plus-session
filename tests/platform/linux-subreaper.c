// Linux ownership qualification harness. This is built for probes/tests, not
// shipped or compiled at session startup. A release needs a packaged helper.
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

static volatile sig_atomic_t requested_signal;
static void request_stop(int sig) { requested_signal = sig; }
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
  if (argc < 2 || prctl(PR_SET_CHILD_SUBREAPER, 1) < 0) { perror("subreaper"); return 125; }
  umask(0077);
  struct sigaction action = {0};
  action.sa_handler = request_stop;
  sigemptyset(&action.sa_mask);
  if (sigaction(SIGTERM, &action, NULL) < 0 || sigaction(SIGINT, &action, NULL) < 0 || sigaction(SIGHUP, &action, NULL) < 0) { perror("sigaction"); return 125; }
  pid_t leader = fork();
  if (leader < 0) { perror("fork"); return 125; }
  if (leader == 0) {
    signal(SIGTERM, SIG_DFL); signal(SIGINT, SIG_DFL); signal(SIGHUP, SIG_DFL);
    execvp(argv[1], argv + 1); perror("execvp"); _exit(126);
  }
  int leader_status = 0, leader_done = 0, status;
  long long stopping_at = 0;
  for (;;) {
    pid_t child;
    while ((child = waitpid(-1, &status, WNOHANG)) > 0) {
      fprintf(stderr, "probe-subreaper: reaped pid=%ld status=%d\n", (long)child, status);
      if (child == leader) { leader_status = status; leader_done = 1; }
    }
    if (child == -1 && errno == ECHILD) break;
    if (child == -1 && errno != EINTR) { perror("waitpid"); return 125; }
    if (leader_done || requested_signal) {
      if (!stopping_at) stopping_at = milliseconds();
      long long elapsed = milliseconds() - stopping_at;
      if (signal_children(elapsed >= 1000 ? SIGKILL : SIGTERM) < 0) return 125;
      if (elapsed >= 5000) { fprintf(stderr, "probe-subreaper: unconfirmed descendant exit\n"); return 125; }
    }
    struct timespec tick = { .tv_sec = 0, .tv_nsec = 10000000 };
    nanosleep(&tick, NULL);
  }
  if (requested_signal) return 128 + requested_signal;
  return WIFEXITED(leader_status) ? WEXITSTATUS(leader_status) : 128 + WTERMSIG(leader_status);
}
