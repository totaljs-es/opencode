# Runs a command inside a pseudo-terminal and bridges it to the pipes of the parent (Python standard library only).
#   stdin  -> the terminal         stdout <- the terminal         fd 3 <- lines "COLUMNS ROWS" to resize
# Usage: python3 terminal.py COLUMNS ROWS COMMAND [ARGUMENT...]

import fcntl
import os
import pty
import select
import struct
import sys
import termios


def resize(fd, columns, rows):
	fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, 0, 0))


def main():

	columns = int(sys.argv[1])
	rows = int(sys.argv[2])
	command = sys.argv[3:]

	pid, fd = pty.fork()

	if pid == 0:
		os.execvp(command[0], command)

	resize(fd, columns, rows)
	control = b''
	readers = [0, 3, fd]

	while True:

		try:
			ready = select.select(readers, [], [])[0]
		except InterruptedError:
			continue

		if fd in ready:
			try:
				data = os.read(fd, 4096)
			except OSError:
				data = b''
			if not data:
				break
			os.write(1, data)

		if 0 in ready:
			data = os.read(0, 4096)
			if data:
				os.write(fd, data)
			else:
				readers.remove(0)

		if 3 in ready:
			data = os.read(3, 256)
			if not data:
				readers.remove(3)
			else:
				control += data
				while b'\n' in control:
					line, control = control.split(b'\n', 1)
					try:
						values = line.split()
						resize(fd, int(values[0]), int(values[1]))
					except Exception:
						pass

	try:
		_, status = os.waitpid(pid, 0)
		sys.exit(os.waitstatus_to_exitcode(status))
	except ChildProcessError:
		sys.exit(0)


main()
